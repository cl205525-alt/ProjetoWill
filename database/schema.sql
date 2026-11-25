-- Cria apenas tabelas no banco selecionado no .env (DB_NAME).
-- Nenhum CREATE DATABASE, USE, DROP ou DELETE e executado.

CREATE TABLE IF NOT EXISTS colaboradores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  usuario VARCHAR(60) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  perfil ENUM('admin','atendente') NOT NULL DEFAULT 'atendente',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS editoras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL UNIQUE,
  cidade VARCHAR(100) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS autores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL UNIQUE,
  nacionalidade VARCHAR(80) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS livros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(240) NOT NULL,
  isbn VARCHAR(20) NULL UNIQUE,
  ano_publicacao SMALLINT UNSIGNED NULL,
  genero VARCHAR(80) NULL,
  sinopse TEXT NULL,
  capa_url VARCHAR(500) NULL,
  editora_id INT NULL,
  quantidade INT UNSIGNED NOT NULL DEFAULT 1,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_livros_editoras FOREIGN KEY (editora_id) REFERENCES editoras(id) ON DELETE SET NULL,
  INDEX idx_livros_titulo (titulo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS livro_autores (
  livro_id INT NOT NULL,
  autor_id INT NOT NULL,
  PRIMARY KEY (livro_id, autor_id),
  CONSTRAINT fk_la_livros FOREIGN KEY (livro_id) REFERENCES livros(id) ON DELETE CASCADE,
  CONSTRAINT fk_la_autores FOREIGN KEY (autor_id) REFERENCES autores(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leitores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  email VARCHAR(180) NULL,
  telefone VARCHAR(24) NULL,
  cidade VARCHAR(100) NULL,
  uf CHAR(2) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cadastrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leitores_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emprestimos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livro_id INT NOT NULL,
  leitor_id INT NOT NULL,
  colaborador_id INT NOT NULL,
  data_retirada DATE NOT NULL,
  data_prevista DATE NOT NULL,
  data_devolucao DATE NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_emp_livros FOREIGN KEY (livro_id) REFERENCES livros(id),
  CONSTRAINT fk_emp_leitores FOREIGN KEY (leitor_id) REFERENCES leitores(id),
  CONSTRAINT fk_emp_colaboradores FOREIGN KEY (colaborador_id) REFERENCES colaboradores(id),
  CONSTRAINT chk_prazo CHECK (data_prevista >= data_retirada),
  INDEX idx_emp_ativos (livro_id, data_devolucao),
  INDEX idx_emp_prazos (data_devolucao, data_prevista)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livro_id INT NOT NULL,
  leitor_id INT NOT NULL,
  status ENUM('aguardando','disponivel','concluida','cancelada') NOT NULL DEFAULT 'aguardando',
  criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  avisada_em DATETIME NULL,
  CONSTRAINT fk_res_livros FOREIGN KEY (livro_id) REFERENCES livros(id),
  CONSTRAINT fk_res_leitores FOREIGN KEY (leitor_id) REFERENCES leitores(id),
  INDEX idx_res_fila (livro_id,status,criada_em,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notificacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id INT NULL,
  leitor_id INT NOT NULL,
  mensagem VARCHAR(500) NOT NULL,
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_not_res FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE SET NULL,
  CONSTRAINT fk_not_leitor FOREIGN KEY (leitor_id) REFERENCES leitores(id)
) ENGINE=InnoDB;

-- Registro de envio independente dos avisos de reserva. Rodar db:setup em uma
-- instalação existente só acrescenta esta tabela; não altera as tabelas antigas.
CREATE TABLE IF NOT EXISTS lembretes_devolucao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emprestimo_id INT NOT NULL,
  data_prevista DATE NOT NULL,
  chave_envio CHAR(36) CHARACTER SET ascii NOT NULL,
  status_envio ENUM('pendente','enviado','falha','sem_email') NOT NULL DEFAULT 'pendente',
  referencia_provedor VARCHAR(80) NULL,
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tentativa_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_em TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_lembrete_emprestimo FOREIGN KEY (emprestimo_id) REFERENCES emprestimos(id) ON DELETE CASCADE,
  UNIQUE KEY uq_lembrete_emprestimo_prazo (emprestimo_id, data_prevista),
  INDEX idx_lembrete_lida_criada (lida, criada_em, id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS colaboradores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(120) NOT NULL,
  usuario VARCHAR(60) NOT NULL UNIQUE,
  senha_hash VARCHAR(255) NOT NULL,
  perfil ENUM('admin','atendente') NOT NULL DEFAULT 'atendente',
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS editoras (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL UNIQUE,
  cidade VARCHAR(100) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS autores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL UNIQUE,
  nacionalidade VARCHAR(80) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS livros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  titulo VARCHAR(240) NOT NULL,
  isbn VARCHAR(20) NULL UNIQUE,
  ano_publicacao SMALLINT UNSIGNED NULL,
  genero VARCHAR(80) NULL,
  capa_url VARCHAR(500) NULL,
  editora_id INT NULL,
  quantidade INT UNSIGNED NOT NULL DEFAULT 1,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_livros_editoras FOREIGN KEY (editora_id) REFERENCES editoras(id) ON DELETE SET NULL,
  INDEX idx_livros_titulo (titulo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS livro_autores (
  livro_id INT NOT NULL,
  autor_id INT NOT NULL,
  PRIMARY KEY (livro_id, autor_id),
  CONSTRAINT fk_la_livros FOREIGN KEY (livro_id) REFERENCES livros(id) ON DELETE CASCADE,
  CONSTRAINT fk_la_autores FOREIGN KEY (autor_id) REFERENCES autores(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS leitores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(160) NOT NULL,
  email VARCHAR(180) NULL,
  telefone VARCHAR(24) NULL,
  cidade VARCHAR(100) NULL,
  uf CHAR(2) NULL,
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  cadastrado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_leitores_nome (nome)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS emprestimos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livro_id INT NOT NULL,
  leitor_id INT NOT NULL,
  colaborador_id INT NOT NULL,
  data_retirada DATE NOT NULL,
  data_prevista DATE NOT NULL,
  data_devolucao DATE NULL,
  criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_emp_livros FOREIGN KEY (livro_id) REFERENCES livros(id),
  CONSTRAINT fk_emp_leitores FOREIGN KEY (leitor_id) REFERENCES leitores(id),
  CONSTRAINT fk_emp_colaboradores FOREIGN KEY (colaborador_id) REFERENCES colaboradores(id),
  CONSTRAINT chk_prazo CHECK (data_prevista >= data_retirada),
  INDEX idx_emp_ativos (livro_id, data_devolucao),
  INDEX idx_emp_prazos (data_devolucao, data_prevista)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS reservas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livro_id INT NOT NULL,
  leitor_id INT NOT NULL,
  status ENUM('aguardando','disponivel','concluida','cancelada') NOT NULL DEFAULT 'aguardando',
  criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  avisada_em DATETIME NULL,
  CONSTRAINT fk_res_livros FOREIGN KEY (livro_id) REFERENCES livros(id),
  CONSTRAINT fk_res_leitores FOREIGN KEY (leitor_id) REFERENCES leitores(id),
  INDEX idx_res_fila (livro_id,status,criada_em,id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notificacoes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reserva_id INT NULL,
  leitor_id INT NOT NULL,
  mensagem VARCHAR(500) NOT NULL,
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  criada_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_not_res FOREIGN KEY (reserva_id) REFERENCES reservas(id) ON DELETE SET NULL,
  CONSTRAINT fk_not_leitor FOREIGN KEY (leitor_id) REFERENCES leitores(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS lembretes_devolucao (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emprestimo_id INT NOT NULL,
  data_prevista DATE NOT NULL,
  chave_envio CHAR(36) CHARACTER SET ascii NOT NULL,
  status_envio ENUM('pendente','enviado','falha','sem_email') NOT NULL DEFAULT 'pendente',
  referencia_provedor VARCHAR(80) NULL,
  lida BOOLEAN NOT NULL DEFAULT FALSE,
  criada_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  tentativa_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enviado_em TIMESTAMP NULL DEFAULT NULL,
  CONSTRAINT fk_lembrete_emprestimo FOREIGN KEY (emprestimo_id) REFERENCES emprestimos(id) ON DELETE CASCADE,
  UNIQUE KEY uq_lembrete_emprestimo_prazo (emprestimo_id, data_prevista),
  INDEX idx_lembrete_lida_criada (lida, criada_em, id)
) ENGINE=InnoDB;
